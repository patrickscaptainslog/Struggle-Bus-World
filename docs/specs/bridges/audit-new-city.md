# What a new city loses or gets wrong today

Audit of the bake against the cached Overture data (2026-10-21.0) and the baked cities in `public/city/`, inside each city's frame. No browser, build or bake was run, so what a player sees is worked out from the data, the code and top-down crops, not watched in the game.

**The short version.** No new city gets a bridge of any kind. Worse than that, the bake takes plain streets away with them: it drops a whole Overture segment if any part of it is a bridge or archway, so more road surface is lost on dry land than over water in all three cities. In Amsterdam, none of the 191 street crossings of a canal survive and the street map falls into 64 pieces. `qa.py` passes all three cities because it never looks at roads.

**One correction to the brief.** Its bridge kilometres are flagged kilometres, not bridge kilometres. Only 39% of SF's flagged length, 27% of Amsterdam's and 12% of London's lies on a real bridge. The rest is at-grade street, or tunnel in the same merged segment.

## Worst first (step 5)

Numbers read SF / Amsterdam / London. "Road" means motorway through service. London's frame is Hyde Park and has no Thames, so its water numbers are a floor, not a picture of London.

| # | What | What the player sees | Measured | Severity |
|---|---|---|---|---|
| 1 | **No bridge over water** | Streets stop at the bank on both sides, with open water between them. A river or canal city is cut into islands. | Road ways over water with no deck: 16 / 93 / 1. Crossing places with a road: 11 / 65 / 1. Amsterdam: 0 of 191 canal crossings kept. | Blocker |
| 2 | **Whole streets vanish with their bridge or archway** | A street stops on dry land for no visible reason and resumes further on. The gap is painted as yard or grass. 854 m of London's West Carriage Drive is gone from Hyde Park because of one bridge. | Road surface lost that is on no bridge: 34.65 / 2.59 / 0.70 ha. London lanes flagged tunnel: 101 ways, 6.98 km, 4.70 ha, 4.3% of its road surface (inferred to be mostly at grade). | Blocker |
| 3 | **Viaducts, overpasses and interchanges have no deck** | Freeways break into stubs, and the corridor reads as a green or grey ribbon between blocks. With #2, 68% of SF's motorway surface is not drawn. | Holes mostly on a real bridge: 233 (40.88 ha) / 49 (0.93 ha) / 3 (0.08 ha). | Blocker |
| 4 | **Flat ground outside USGS coverage** | A hilly city outside the US is a flat plate, with no hills on the horizon. Fine for Amsterdam, wrong for Lisbon or Rio (inferred). | SF -6.1 to 340.8 m. Amsterdam and London: land 1.0 m everywhere, water -0.9 m. `horizon.bin` exists for SF only. | Major |
| 5 | **Bridge towers arrive as bare boxes in the water** | Grey slabs up to 160 m tall stand in open water with no deck, near and in the far skyline. SF hides its own by hand. | `bridge_structure` rows: 6 (five at 160 m, one at 67 m) / 0 / 0. | Major |
| 6 | **Underground car parks are painted on the surface** | Asphalt slabs in parks. Q-Park Marble Arch is a 2.9 ha grey block in the north-east of Hyde Park, and an unnamed 1.53 ha one lies in Golden Gate Park. | Paved over a park or plaza: 1.57 / 0.04 / 3.01 ha. | Major |
| 7 | **Every city gets San Francisco's houses and roofs** | Amsterdam and London houses carry SF bay windows, stoops and chimneys (from the mesher code, not seen rendered). | Baked `victorian`: 37.7 / 55.0 / 59.7%. Roofs with no shape data: SF 99.8%, London 97.9%. Amsterdam's gables are a config line. | Major |
| 8 | Tunnel mouths | A road just ends. On flat ground there is not even a hill to explain it, as at the Piccadilly Underpass. | Mouths: 129 / 12 / 138. All of them have no portal. | Minor |
| 9 | Trams and rail | Trams never draw. They run in streets, where road paint would cover them anyway. Rail stops at viaducts. | Rail km kept: 62.99 of 250.52 / 4.37 of 37.84 / 0 of 26.34, mostly tunnels and trams. | Minor |
| 10 | Breakwaters and harbour moles | Open water where a mole should be. | On baked water: 6.07 ha of 14.32 / none / none. | Minor |
| 11 | Streams mapped only as lines | No stream. Nobody would miss most of them. | Open streams missing: 23.29 km / 0 / 0.09 km. | Minor |
| 12 | Guessed building heights | A few wrong heights among right ones. | Guessed: 1.0% / 11.2% / 24.9%. SF has LiDAR; a city with fewer OSM height tags would guess more. | Minor |
| 13 | Road widths and sidewalks | Streets are SF-width everywhere. Buildings cover the excess. | Road km with a width tag: 0.7 / 10.8 / 2.4%. | Minor |
| 14 | Tree species | SF's trees in Hyde Park, including narrow cypresses. | Cypress trees baked: 15,433 / 19 / 1,624. | Minor |
| 15 | Canopies and buildings on stilts | A few station roofs and raised blocks missing. | `building=roof`: 3.58 / 0.07 / 0.39 ha. Stilted: 1.02 / 0 / 0 ha. | Minor |
| 16 | Tall structures that are not buildings | Almost nothing in these frames. A lattice tower mapped as a building would become a solid prism (inferred from Sutro's row: 757 m² at 298 m). | Tallest free-standing with a height tag: 31 m, in SF. | Minor |
| 17 | Walls, fences, power lines, ferries, lamps | Not visible from a flying bus. | See step 2. | None |
| 18 | Cranes, chimneys, city walls | Nothing to lose here: no row in the cache mentions them. | 0 / 0 / 0. | None |
| 19 | Stadiums, piers | These work. Oracle Park keeps its field as a hole, and piers draw. | See step 2. | None |

![Amsterdam: dark is road, magenta is a dropped road, cyan is a real bridge](../../../shots/local/bridges/amsterdam_all.png)

## Step 1: what the bake skips, flattens or fakes

| Kind | The rule | Where |
|---|---|---|
| **Skips** | | |
| Bridges, tunnels, indoor and covered ways, ways under construction | The whole segment goes if any part of it carries the flag | `osm.py:363-365`, flags merged at `overture.py:150-152` |
| Any way off level 0 | Same, by the segment's highest level | `osm.py:366-368`, `overture.py:149` |
| Trams, at-grade subway, funiculars, unknown rail | Only five rail classes are read | `osm.py:372-375` |
| Ferries | Not a road | `osm.py:376` |
| Nearly all of the infrastructure theme | Only parking, piers, quays, boardwalks, platforms and airports are read. Bridge polygons and supports, towers, masts, pylons, power lines, breakwaters, dams, walls and fences are not. | `osm.py:495-505` |
| Waterways mapped as lines | Polygons only | `osm.py:515` |
| Canopies | `building=roof` | `osm.py:264` |
| Skyways and stilted buildings | `min_height` over 2.5 m with no parts | `osm.py:269-271` |
| **Flattens** | | |
| Terrain | No DEM means flat at `groundLevel`. The only DEM, LiDAR and horizon sources are USGS. | `bake.py:1583-1584`, `2062-2064`, `horizon.py:24` |
| Everything on the ground | One 2 m class texture. A road has no height, so a deck or a stack can't be expressed. | `osm.py:560-632` |
| Level of parking and platforms | Never read, so underground ones paint the surface. Platforms lie mostly under streets, where road paint hides them. | `osm.py:498-503` |
| Pier decks | A flat 2.5 m | `bake.py:1613-1621` |
| **Fakes** | | |
| Road widths and sidewalks | By class; 3.5 m of sidewalk beside most streets | `osm.py:58-65` |
| Yards or paved lots | From the block's building mix | `osm.py:589-597` |
| Building heights | Neighbours' median within 40 m, then a class default | `bake.py:1717-1726` |
| House type | `victorian` unless the config lists districts | `bake.py:1954-1959`, `2205` |
| Roof shape | A per-city config default | `bake.py:2155` |
| Tree species | 18% of procedural trees are cypress, the rest SF park trees | `bake.py:2347` |
| Street trees | Placed along frontages, not from data | `bake.py:2350-2378` |
| Landmarks and bridges | Hand-built, SF only. The tables that hide OSM's stand-ins also run for SF only. | `Bridges.ts`, `towerStyles.ts:214-276` |

## Step 2: how much of each exists, inside the frame

| Thing | SF | Amsterdam | London |
|---|---|---|---|
| Road ways with a bridge flag | 636, 148.88 km | 206, 20.76 km | 22, 3.32 km |
| Rail ways with a bridge flag | 24, 86.20 km | 73, 20.31 km | 4, 6.51 km |
| All flagged length on a real bridge | 91.04 of 234.01 km | 11.03 of 40.84 km | 1.17 of 9.83 km |
| Real bridge rows (of them polygons) | 963 (93) | 433 (124) | 28 (3) |
| Bridge supports | 111 | 8 | 0 |
| Road ways with a tunnel flag and no bridge flag | 270, 29.88 km | 63, 4.37 km | 268, 14.34 km |
| Rail ways with a tunnel flag and no bridge flag | 74, 51.15 km | 2, 2.49 km | 26, 19.65 km |
| Covered / indoor / under construction, road km | 17.19 / 3.14 / 3.78 | 0.11 / 0.20 / 0 | 1.30 / 0.07 / 0.03 |
| Dropped by level alone, road km | 20.03 | 0.72 | 0.80 |
| Road ways at level 2 or higher | 73, 41.24 km | 2, 0.59 km | 0 |
| Ground under 3 or more ways | 8.44 ha | 0.35 ha | 0.22 ha |
| Trams | 34.95 km | 23.24 km | 0 |
| Piers: polygons, lines | 221 (47.46 ha), 1,153 (34.29 km) | 10 (0.19 ha), 49 (1.66 km) | 1 (0.07 ha), 1 (0.02 km) |
| Ferries | 20, 107.74 km | 0 | 0 |
| Stadium polygons; `building=stadium`; grandstands | 13 (23.85 ha); 1; 11 | 0 | 0 |
| Communication towers (inside a footprint) | 26 (11) | 63 (59) | 0 |
| Lighting masts | 279 | 0 | 0 |
| Pylons; power lines | 27; 85.19 km | 0; 0 | 0; 0 |
| Canal polygons | 0 | 25.72 ha | 0 |
| Waterway lines | 45.21 km | 23.72 km | 4.06 km |
| Lock rows | 0 | 0 | 0 |
| Walls; fences | 57.73 km; 154.33 km | 2.04 km; 1.24 km | 17.09 km; 33.78 km |
| Breakwaters; dams | 103 (31.75 km); 5 | 0; 0 | 0; 0 |
| `building=roof`; stilted | 234 (3.58 ha); 11 (1.02 ha) | 7 (0.07 ha); 0 | 14 (0.39 ha); 0 |
| Underground car parks | 7 (2.81 ha) | 2 (1.72 ha) | 7 (4.08 ha) |

## Step 3: what the player gets

**How this was measured.** I read the baked ground from `public/city/<slug>/r_*.bin`, then drew every dropped way over it with `osm.py`'s own widths on the same 2 m grid. A "hole" is dropped road surface with no kept road on it. "Real bridge" means within 6 m of an infrastructure-theme bridge way or 2 m of a bridge polygon.

**The road ends at the water.** A way counts when at least 6 m of it runs over baked water. Runs within 30 m of each other count as one place, because one bridge can carry lanes, a cycleway and a tram.

| | SF | Amsterdam | London |
|---|---|---|---|
| Road ways over water | 20 (9,261 m) | 93 (1,582 m) | 1 (86 m) |
| Under a hand-built deck | 4 (7,616 m) | 0 | 0 |
| **With no deck at all** | **16 (1,645 m)** | **93 (1,582 m)** | **1 (86 m)** |
| Places with a road, no deck | 11 | 65 | 1 |
| Places of any kind, no deck | 53 | 83 | 1 |
| Places with rail or tram | 4 | 18 | 0 |

SF's places include the Bay Bridge east span (424 m), Illinois Street (144 m), 3rd Street and 4th Street. BART's Transbay Tube runs under the water, so it is left out. London's one place is the Serpentine Bridge.

**Are Amsterdam's streets cut at every canal? Yes.** This uses the canal centrelines, so it doesn't depend on the runs above.

| Amsterdam | |
|---|---|
| Street crossings of a canal or river | 191 points at 105 places (124 points at 88 places carry a road) |
| On a kept way | **0** |
| Road points baked as | 100 water, 20 yard, 3 paved, 1 sidewalk |
| Road continuous for 30 m either side | 2 of 124, both by accident (below) |
| Median gap on the road | 28 m |
| Land pieces of 1 ha or more | 13; the largest is 120.1 of 364 ha |

The non-water points are places where OSM's water polygon stops at the bridge. The canal then gets a bar of bare ground with no road on it. The two "continuous" crossings are bars of that kind on the Herengracht that happened to bake as paved lot (`amsterdam_herengracht.png`).

**The street map as a figure.** This counts connected pieces of painted road.

| | SF | Amsterdam | London |
|---|---|---|---|
| Pieces as baked | 234 | **64** | 52 |
| Largest piece's share | 94.4% | **13.4%** | 97.2% |
| Pieces with dropped ways restored | 189 | 26 | 47 |
| Largest piece's share restored | 98.4% | 92.8% | 98.4% |

**Holes on land.** Road ways with a bridge flag, holes of 80 m² or more.

| | SF | Amsterdam | London |
|---|---|---|---|
| Holes | 330 (82.96 ha) | 84 (4.10 ha) | 6 (0.79 ha) |
| Mostly on a real bridge: viaducts, overpasses | 233 (40.88 ha) | 49 (0.93 ha) | 3 (0.08 ha) |
| Mostly at grade | 97 (42.08 ha) | 35 (3.17 ha) | 3 (0.71 ha) |
| Painted as | yard 33.6, paved 21.6, grass 17.2 ha | yard 3.2 ha | grass 0.55 ha |

**Where the surface went.** Road ways with a bridge flag.

| ha | SF | Amsterdam | London |
|---|---|---|---|
| Over water | 9.15 | 1.63 | 0.08 |
| Land, on a real bridge | 42.07 | 1.66 | 0.09 |
| **Land, bridge flag alone, on no bridge** | **34.65** | **2.59** | **0.70** |
| Land, bridge and tunnel flags, on no bridge | 6.51 | 0.15 | 0 |
| Road surface kept, for scale | 2,229.66 | 78.18 | 108.55 |

Counting every reason, the bake drops 5.5 / 9.3 / 8.9% of road length. SF's motorways take the worst of it: 93.76 of 130.51 km dropped, with 35.66 ha drawn, 77.31 ha missing and 6.37 ha in tunnels.

**The worst single holes.** In SF:

- I-280 through Dogpatch, 4.19 ha, running 1,406 m north to south
- James Lick Freeway, 2.56 ha, level 4
- Alemany and Foran, 2.35 ha
- Southern Embarcadero Freeway at the 101/280 interchange, 1.96 ha, level 4

Amsterdam's largest is 0.30 ha, and London's is West Carriage Drive at 0.64 ha.

**Named streets hit.**

| | SF | Amsterdam | London |
|---|---|---|---|
| Named road streets | 2,435 | 286 | 526 |
| With some way dropped | 78 | 83 | 64 |
| Gone entirely | 9 | 44 | 46 |
| All names gone from the street sign, paths included | 34 of 2,798 | 80 of 482 | 60 of 583 |

**Examples of streets lost at grade**, with the share of each way that is on a real bridge:

- SF: James Lick Freeway 1,724 m (19%), John F Foran Freeway 1,365 m (20%)
- Amsterdam: Singel 397 m (8%), Marnixstraat 315 m (7%)
- London: West Carriage Drive 854 m (14%)
- London tunnel flag, share under a building: Bathurst Mews 253 m (9%), Gloucester Mews 175 m (6%), Eastbourne Mews 170 m (6%)

![London: the dark block near the top is Q-Park Marble Arch, painted over Hyde Park](../../../shots/local/bridges/london_hyde_ne.png)

## Step 4: what qa.py checks and cannot see

All three cities pass all five checks today.

| Check | Fails when | Today: SF / Amsterdam / London | What it cannot see |
|---|---|---|---|
| `unsupported` | Over 5% of procedural park trees have no WorldCover tree within 20 m, and at least 50 trees | 0.05 / 0 / 0.07% | Anything but park trees |
| `openCells` | Over 1% of 128 m land cells hold 8 or more such trees, and at least 5 cells | 0.01 / 0 / 0% | Same |
| `woodCells` | Over 10% of wooded park cells are left bare, and at least 5 cells | 2.26 / 0 / 0% | Same |
| `waterCells` | Over 2% of cells differ from WorldCover by half a cell of water, and at least 5 cells | 0.06 / 0 / 0% | Canals and bridges. 171 of Amsterdam's 177 cells with water hold under 50% of it, so they could lose all of it and still pass. |
| `sandCells` | Over 2% of land cells disagree on sand, and at least 5 cells | 0.10 / 0 / 0% | Anything but sand |
| Street trees, scrub | Reported, never fail | | |
| No check | | | Roads at all: holes, cut streets, the street figure (Amsterdam's largest piece is 13.4%) |
| No check | | | Roads that end at water, and decks |
| No check | | | Buildings: heights, boxes standing in water |
| No check | | | Hand-built props against the data (the Bay Bridge's 154 m offset passes) |
| No check | | | Underground things painted on the surface, rail, terrain |
| The whole QA | Skipped when a config sets `"worldcover": false` | | Everything |

A road gate would have something to read. The largest street piece (94.4 / 13.4 / 97.2%) would fail Amsterdam at once, and the share of road way over water with no deck is another candidate.

## How sure each thing is

**Checked:**

- My way classifier gives the same counts as the bake's own `OSM.segments()`: 47,609 / 1,824 / 3,962.
- My road drawing agrees with the bake: 99.1 / 91.8 / 96.3% of kept-road cells read as paved, and nearly all the rest lie under buildings.

**Inferred, not measured:**

- **That a flag covers only part of a segment.** The `between` ranges were thrown away by `overture.py` and are not in the cache. The evidence is indirect but strong: a 313 m Serpentine Bridge segment whose first OSM way is a 105 m bridge, and the on-bridge shares above.
- **"Real bridge" depends on the infrastructure list.** 3 to 4% of short flagged ways have nothing on it, so the at-grade figures could run that much high.
- **Tunnels have no such list.** London's lanes are judged by how little of each lies under a building.
- **Everything about cities I don't have data for**, including the flat-ground row for hilly cities.
- **Rows 7 and 16.** Row 7's look comes from reading the mesher, not from seeing it rendered. Row 16's prism comes from one OSM row.

**Limits of the data:**

- London's frame has no Thames. Amsterdam's has no motorways. SF has the only stadium and the only tagged bridge towers.
- Amsterdam's extract covers x -933 to 974 of a ±1,024 m frame, and London's stops at x 1,229 of 1,280. The outer strips hold only features that cross into the extract. The bake saw the same data.
- Rail's bridge numbers mix in tunnels: 48.61 km of SF's rail carries both flags, BART included.
- The brief's way counts (650 / 255 / 23) don't reproduce. I get 678 / 313 / 30 for the whole extract and 660 / 279 / 26 in the frame, and this report uses the frame.

**For planning.** Fixing #2 properly needs a fresh Overture extract that keeps `between`, which means network access. For bridges alone, the cached infrastructure list could cut the ways instead. Tunnels have no such list. Decks for #1 and #3 should wait until #2 is fixed, or they would be built over kilometres of at-grade street.

## Files

Everything is in `shots/local/bridges/`, which is not in git, the two pictures above included.

- Crops: `amsterdam_all.png`, `amsterdam_herengracht.png`, `amsterdam_brouwersgracht.png`, `london_hyde_ne.png`, `sf_280_101.png`
- Data: `crossings_<slug>.csv`, `canal_points_<slug>.csv`, `holes.json`, `canals_stacks.json`, `inventory.json`
- Scripts: `common.py`, `inventory.py`, `segments_table.py`, `flag_overreach.py`, `verify_overreach.py`, `holes.py`, `canals_stacks.py`, `surface_fakes.py`, `buildings_audit.py`, `extras.py`, `finals.py`, `lanes.py`, `crops.py`
